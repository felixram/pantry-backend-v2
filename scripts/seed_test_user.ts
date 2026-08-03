import { db } from "../src/db/index.ts"
import { User } from "../src/db/schema/users.ts"
import { hashPassword } from "../src/utils/passwordUtils.ts"
import { randomUUID } from "crypto"

async function seedTestUser() {
  try {
    const passwordHash = await hashPassword("password123")

    await db.insert(User).values({
      id: randomUUID(),
      name: "Test",
      last_name: "Admin",
      email: "admin@example.com",
      password: passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    }).onConflictDoNothing()

    console.log("✅ Test user created successfully!")
    console.log("   Email: admin@example.com")
    console.log("   Password: password123")
    console.log("   Role: ADMIN")

    process.exit(0)
  } catch (error: any) {
    console.error("❌ Error:", error.message)
    process.exit(1)
  }
}

seedTestUser()
