# Ventory Server - Development Guide

This is a TypeScript/Express backend for an inventory management system with purchase order workflows, stock tracking, and multi-user role-based access control.

## Quick Start Commands

### Development
```bash
npm run dev              # Start dev server with hot reload (tsx watch)
npm run test            # Run tests in watch mode
npm run test:run        # Run tests once
npm run test:coverage   # Generate coverage report
npm run test:ui         # Run tests with interactive UI
```

### Database
```bash
npm run g               # Generate DB migrations (drizzle-kit)
npm run m               # Run pending migrations
```

### Testing (by category)
```bash
npm run test:unit       # Run unit tests only
npm run test:integration # Run integration tests only
npm run test:e2e        # Run end-to-end tests only
```

## Architecture Overview

### Tech Stack
- **Framework**: Express.js (Node.js)
- **RPC**: tRPC (type-safe API layer)
- **Database**: PostgreSQL with Drizzle ORM
- **Validation**: Zod (runtime type validation)
- **Testing**: Vitest with coverage
- **Auth**: JWT tokens + bcrypt password hashing
- **Environment**: ESM (modern JavaScript modules)

### Directory Structure

```
src/
├── db/                    # Database layer
│   ├── index.ts          # Drizzle client initialization
│   ├── schemaHelpers.ts  # Reusable schema column helpers
│   └── schema/           # All table definitions
│       ├── users.ts
│       ├── purchaseOrder.ts
│       ├── purchaseOrderItem.ts
│       ├── purchaseOrder_audit_log.ts
│       ├── product.ts
│       ├── category.ts
│       ├── location.ts
│       ├── supplier.ts
│       ├── stock.ts
│       └── stockMovement.ts
├── server/
│   ├── index.ts          # Entry point
│   ├── trpc.ts           # tRPC initialization + middleware (isAuthed, isAdmin)
│   ├── context.ts        # Context setup (user, db, req/res)
│   ├── routers/          # tRPC routers (API endpoint groups)
│   │   ├── index.ts      # Main router combining all sub-routers
│   │   ├── auth/
│   │   ├── user/
│   │   ├── product/
│   │   ├── purchaseOrder/
│   │   ├── stock/
│   │   ├── stockMovement/
│   │   ├── location/
│   │   ├── supplier/
│   │   ├── category/
│   │   └── report/
│   └── controllers/      # Procedure implementations
│       ├── authControllers/
│       ├── userControllers/
│       ├── productControllers/
│       ├── purchase_orderController/
│       ├── stockControllers/
│       ├── stockMovementControllers/
│       ├── locationControllers/
│       ├── supplierControllers/
│       ├── categoryControllers/
│       └── reportControllers/
├── types/
│   ├── user.ts           # ROLES enum (user, admin)
│   ├── orders.ts         # ORDER_STATUS enum (workflow states)
│   ├── jwtTypes.ts       # JWT payload interface
│   └── index.ts
├── utils/
│   ├── tokenUtils.ts     # JWT sign/verify
│   └── passwordUtils.ts  # bcrypt hash/compare
├── middlewares/
│   ├── authMiddleware.ts
│   └── adminMiddleware.ts
└── __tests__/
    ├── setup.ts          # Global test setup
    ├── helpers/
    │   ├── auth.ts       # Auth helpers for tests
    │   ├── factories.ts   # Data factories (faker)
    │   └── testDb.ts     # Test database setup
    └── unit/
        └── controllers/   # Test files (*.test.ts)
```

## Core Concepts

### 1. TRPC Procedures (API Endpoints)

All API endpoints are defined as tRPC procedures. Two types available:

```typescript
// authedProcedure: requires user authentication
export const someEndpoint = authedProcedure
  .input(z.object({ id: z.string() }))
  .query(async ({ ctx, input }) => {
    // ctx has: db, user, req, res
    // input is Zod-validated
  })

// adminProcedure: requires admin role
export const adminEndpoint = adminProcedure
  .input(z.object({ id: z.string() }))
  .mutation(async ({ ctx, input }) => {
    // Only accessible to ROLES.admin users
  })
```

**Key Pattern**: `input` → `query` (read) or `mutation` (write) → `output`

### 2. Database Layer with Drizzle ORM

All tables are defined in `src/db/schema/` with relations. Example:

```typescript
// purchaseOrderItem.ts
export const PurchaseOrderItem = pgTable('purchase_order_items', {
  id: id(),
  purchase_order_id: uuid().notNull().references(() => PurchaseOrder.id),
  product_id: uuid().notNull().references(() => Product.id),
  qty: numeric().notNull(),
  unit_price: numeric().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(), // soft delete
})

export const purchaseOrderItemRelations = relations(PurchaseOrderItem, ({ one }) => ({
  product: one(Product, {
    fields: [PurchaseOrderItem.product_id],
    references: [Product.id],
  }),
}))
```

**Important**: When accessing related data, always use `with: { relation: true }`:
```typescript
const item = await tx.query.PurchaseOrderItem.findFirst({
  where: eq(PurchaseOrderItem.id, itemId),
  with: { product: true }, // Fetch the related product
})
```

### 3. Database Transactions

All mutations that modify multiple tables use transactions for consistency:

```typescript
return await ctx.db.transaction(async (tx) => {
  // All operations here are atomic
  // Either all succeed or all rollback
  await tx.insert(Table1).values(...)
  await tx.update(Table2).set(...)
  // If any operation fails, entire transaction rolls back
})
```

### 4. Role-Based Access Control

Two roles defined in `src/types/user.ts`:
- `ROLES.user`: Regular users, subject to workflows
- `ROLES.admin`: System administrators, unrestricted access

Check in procedures:
```typescript
if (ctx.user!.role === ROLES.user) {
  // USER-specific logic
}
```

### 5. Purchase Order State Machine

Purchase Orders follow a strict workflow with status transitions:

```
DRAFT
  ├→ PENDING_APPROVAL → APPROVED → ORDERED → RECEIVED (terminal)
  └→ CANCELLED (terminal)

PENDING_APPROVAL → REJECTED (terminal)
```

**Terminal States** (cannot be modified):
- `RECEIVED`: Order received from supplier
- `REJECTED`: Order was rejected during approval
- `CANCELLED`: Order was cancelled

**Key Pattern**: When items are modified by a USER:
- If PO is in PENDING_APPROVAL, APPROVED, or ORDERED → auto-revert to DRAFT
- If PO is in DRAFT or modified by ADMIN → status unchanged
- Terminal states block all modifications

### 6. Audit Logging

`PurchaseOrderAudit` table tracks changes:
- **Tracked fields**: `fieldChanged`, `oldValue`, `newValue`, `reason`
- **Logged for**: USER role modifications only (ADMIN changes are not audited)
- **Exempt from logging**: DRAFT status orders
- **Audit context**: Includes userId, purchaseOrderId, timestamp

Example from `updatePurchaseOrderItem.ts`:
```typescript
if (
  purchaseOrder.status !== ORDER_STATUS.draft &&
  ctx.user!.role === ROLES.user
) {
  await tx.insert(PurchaseOrderAudit).values({
    purchaseOrderId: input.purchaseOrderId,
    userId: ctx.user!.id,
    fieldChanged: "item_updated",
    oldValue: JSON.stringify(oldValue),
    newValue: JSON.stringify(newValue),
    reason: input.reason,
  })
}
```

### 7. Soft Deletes

Most entities use soft deletes with `deletedAt` timestamp:

```typescript
// Mark as deleted (doesn't remove data)
await tx.update(Table).set({ deletedAt: new Date() })

// Query excluding soft-deleted (typically done in getAll procedures)
where: isNull(Table.deletedAt)
```

## Common Development Tasks

### Adding a New API Endpoint

1. **Create controller** in `src/server/controllers/{domain}Controller/yourEndpoint.ts`
2. **Define procedure** with tRPC (authedProcedure or adminProcedure)
3. **Add input validation** with Zod
4. **Implement logic** with database transactions as needed
5. **Export from index** `src/server/controllers/{domain}Controller/index.ts`
6. **Add to router** in `src/server/routers/{domain}/{domain}.ts`
7. **Test**: Create test file in `src/__tests__/unit/controllers/{domain}.test.ts`

### Modifying Database Schema

1. **Update table definition** in `src/db/schema/yourTable.ts`
2. **Update relations** if foreign keys changed
3. **Generate migration**: `npm run g`
4. **Review migration** in `drizzle/` folder
5. **Run migration**: `npm run m`
6. **Update procedures** that query this table

### Handling Relationships

**One-to-Many**: Product has many PurchaseOrderItems
```typescript
// In schema: PurchaseOrderItem references Product
with: { purchaseOrderItems: true }

// Query:
const product = await tx.query.Product.findFirst({
  where: eq(Product.id, productId),
  with: { purchaseOrderItems: true }, // Gets array
})
```

**One-to-One**: PurchaseOrderItem has one Product
```typescript
// In schema: PurchaseOrderItem has one Product relation
with: { product: true }

// Query:
const item = await tx.query.PurchaseOrderItem.findFirst({
  where: eq(PurchaseOrderItem.id, itemId),
  with: { product: true }, // Gets single object
})
```

## Testing Strategy

### Test Setup
- **Framework**: Vitest (configured in `vitest.config.ts`)
- **Database**: Test DB with separate migrations (see `.env.test`)
- **Helpers**: Factories (faker), test DB utilities, auth helpers
- **Coverage**: Target 70% lines/functions, 60% branches

### Test Categories
- **Unit**: Single function/procedure logic
- **Integration**: Multiple modules together
- **E2E**: Full workflow testing

### Running Tests
```bash
npm run test              # Watch mode
npm run test:run         # Once
npm run test:coverage    # With coverage report
npm run test:ui          # Interactive UI
```

### Writing Tests
```typescript
// src/__tests__/unit/controllers/yourFeature.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('YourFeature', () => {
  it('should do something', async () => {
    // Setup
    // Execute
    // Assert
  })
})
```

## Key Files to Know

### Configuration
- `package.json`: Dependencies and scripts
- `tsconfig.json`: TypeScript strict mode enabled
- `vitest.config.ts`: Test setup with coverage thresholds
- `.env.test`: Test database credentials

### Entry Points
- `src/index.ts`: Express app initialization
- `src/server/routers/index.ts`: Main app router combining all sub-routers
- `src/server/trpc.ts`: TRPC configuration and middleware

### Type Definitions
- `src/types/user.ts`: `ROLES` enum (user, admin)
- `src/types/orders.ts`: `ORDER_STATUS` enum (workflow states)
- `src/types/jwtTypes.ts`: JWT payload interface

### Critical Patterns
- **Schema helpers**: `src/db/schemaHelpers.ts` - Use these in schema definitions
- **Token utils**: `src/utils/tokenUtils.ts` - JWT sign/verify
- **Password utils**: `src/utils/passwordUtils.ts` - Bcrypt operations

## Environment Variables

Required in `.env`:
```
DATABASE_URL=postgresql://user:password@localhost:5432/ventory
PORT=3030 (defaults to 3030 if not set)
JWT_SECRET=your-secret-key
```

## Important Development Notes

### 1. TypeScript Strictness
- `strict: true` enabled in `tsconfig.json`
- `exactOptionalPropertyTypes`: true (required for precise Zod types)
- `noUncheckedIndexedAccess`: true
- Always type your inputs and outputs

### 2. Database Integrity
- Always wrap multi-table mutations in transactions
- Use `.returning()` when you need the inserted/updated row
- Check for terminal states before allowing modifications
- Verify foreign key existence before references

### 3. API Design
- Input validation is REQUIRED (Zod schemas)
- Use descriptive error messages (TRPCError)
- Status codes matter: NOT_FOUND, BAD_REQUEST, FORBIDDEN, UNAUTHORIZED
- Return meaningful response objects with messages

### 4. Role-Based Logic
- Check `ctx.user!.role === ROLES.user` for user-specific behavior
- ADMIN users bypass certain workflows (no auto-revert, not audited)
- Always validate permissions in the procedure, not in controller

### 5. Common Pitfalls to Avoid
- **Missing `with` clause**: Relations won't load automatically, need explicit `with: {}`
- **Forgetting transactions**: Multi-table updates can become inconsistent
- **No `.returning()`**: When you insert/update and need the result, add `.returning()`
- **Audit logging conditions**: Must check both status AND role before logging
- **Soft delete queries**: Remember to add `.where(isNull(Table.deletedAt))`

## Testing Best Practices

1. **Use factories**: `createTestUser()`, `createTestProduct()` from `src/__tests__/helpers/factories.ts`
2. **Setup/teardown**: Use `beforeEach`/`afterEach` to clean state
3. **Test isolation**: Each test should be independent
4. **Coverage goals**: Aim for 70%+ line coverage
5. **Meaningful assertions**: Test behavior, not implementation details

## Performance Considerations

- **N+1 queries**: Always eager-load relations with `with: {}`
- **Transactions**: Use for consistency, but they can be slow
- **Audit logging**: Limited to USER actions to reduce write volume
- **Soft deletes**: Filter with `isNull(deletedAt)` consistently

## Future Enhancement Areas

Based on recent work:
1. **Purchase Order workflows** - Fully implemented with role-based state management
2. **Granular item modifications** - Add, update, remove individual PO items
3. **Audit trail** - Complete tracking of USER modifications
4. **ADMIN flexibility** - Admin users can bypass approval workflows

## API Endpoint Summary

**11 Routers, 50+ Endpoints** documented in `Postman_Collection.json`:
- Auth: login, logout, current user
- Users: CRUD + admin update
- Products: CRUD + price history, cost analysis
- Categories: CRUD
- Locations: CRUD
- Suppliers: CRUD
- Purchase Orders: Create, read, update, delete, item management
- Stock: Create, adjust, transfer, set minimum level
- Stock Movement: Tracking and history
- Reports: Inventory valuation, low stock, supplier performance, PO summary
