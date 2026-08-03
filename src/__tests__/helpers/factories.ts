import { faker } from '@faker-js/faker';

// Type definitions for factory outputs
export interface ProductFactoryOutput {
  name: string;
  sku: string;
  unit: string[];
  category_id?: string;
  supplier_id?: string;
}

export interface SupplierFactoryOutput {
  name: string;
  contact_name: string;
  phone: string;
  email: string;
  address: string;
  supplier_type: 'PRIMARY' | 'SECONDARY';
  delivery_days?: string;
  free_shipping_minimum?: number;
  notes?: string;
}

export interface CategoryFactoryOutput {
  name: string;
  description: string;
}

export interface LocationFactoryOutput {
  name: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  active?: boolean;
}

export const productFactory = (overrides: Partial<ProductFactoryOutput> = {}): ProductFactoryOutput => ({
  name: faker.commerce.productName(),
  sku: faker.string.alphanumeric(8).toUpperCase(),
  unit: [faker.helpers.arrayElement(['kg', 'liter', 'box', 'unit'])],
  ...overrides,
});

export const supplierFactory = (overrides: Partial<SupplierFactoryOutput> = {}): SupplierFactoryOutput => ({
  name: faker.company.name(),
  contact_name: faker.person.fullName(),
  phone: faker.phone.number(),
  email: faker.internet.email(),
  address: faker.location.streetAddress(),
  supplier_type: 'PRIMARY',
  ...overrides,
});

export const categoryFactory = (overrides: Partial<CategoryFactoryOutput> = {}): CategoryFactoryOutput => ({
  name: faker.commerce.department(),
  description: faker.commerce.productDescription(),
  ...overrides,
});

export const locationFactory = (overrides: Partial<LocationFactoryOutput> = {}): LocationFactoryOutput => ({
  name: faker.company.name() + ' Warehouse',
  address: faker.location.streetAddress(),
  city: faker.location.city(),
  state: faker.location.state(),
  postalCode: faker.location.zipCode(),
  ...overrides,
});
