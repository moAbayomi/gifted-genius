
import { createSchoolWithDefaults } from '../modules/schools/service.js';
import db from '../db/client.js';
import { users, levels } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { one } from '../shared/utils/assert.js';

const owner = one(await db.insert(users).values({ email: 'fresh@test.com', firstName: 'F', lastName: 'L' }).returning());
const result = await createSchoolWithDefaults({ name: 'Fresh', slug: 'fresh-test', ownerUserId: owner.id });
const ls = await db.select().from(levels).where(eq(levels.schoolId, result.school.id));
console.log('Levels:', ls.map(l => l.name));
