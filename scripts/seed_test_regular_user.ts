import { db } from "../src/db/index.ts"
import { User } from "../src/db/schema/users.ts"
import { Location } from "../src/db/schema/location.ts"
import { hashPassword } from "../src/utils/passwordUtils.ts"
import { randomUUID } from "crypto"

async function seedRegularUser() {
  try {
    const passwordHash = await hashPassword("password123")

    // Get first active location for the user
    const locations = await db.query.Location.findMany({
      limit: 1,
    })

    if (locations.length === 0) {
      console.error("❌ No locations found! Please seed test data first.")
      process.exit(1)
    }

    const locationId = locations[0].id

    await db.insert(User).values({
      id: randomUUID(),
      name: "Test",
      last_name: "User",
      email: "user@example.com",
      password: passwordHash,
      role: "USER",
      status: "ACTIVE",
      location_id: locationId,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    }).onConflictDoNothing()

    console.log("✅ Test USER role user created successfully!")
    console.log("   Email: user@example.com")
    console.log("   Password: password123")
    console.log("   Role: USER")
    console.log(`   Assigned Location ID: ${locationId}`)

    process.exit(0)
  } catch (error: any) {
    console.error("❌ Error:", error.message)
    process.exit(1)
  }
}

seedRegularUser()
