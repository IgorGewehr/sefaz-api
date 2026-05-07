// Container-side seed runner. Mirrors prisma/seed.ts but runs against the
// generated client without needing tsx — keeps the production image lean.
const { PrismaClient, Plan } = require('@prisma/client');
const { createHash, randomBytes } = require('node:crypto');

const prisma = new PrismaClient();

function generateApiKey() {
  const random = randomBytes(32).toString('base64url');
  const plaintext = `sk_live_${random}`;
  const hash = createHash('sha256').update(plaintext).digest('hex');
  const prefix = plaintext.slice(0, 14);
  return { plaintext, hash, prefix };
}

(async () => {
  try {
    const adminEmail = process.env.ADMIN_TENANT_EMAIL || 'admin@example.com';
    const adminName = process.env.ADMIN_TENANT_NAME || 'Sefaz API Admin';

    const tenant = await prisma.tenant.upsert({
      where: { email: adminEmail },
      update: {},
      create: { name: adminName, email: adminEmail, plan: Plan.ENTERPRISE },
    });

    const existing = await prisma.apiKey.findFirst({
      where: { tenantId: tenant.id, revokedAt: null },
    });
    if (!existing) {
      const { plaintext, hash, prefix } = generateApiKey();
      await prisma.apiKey.create({
        data: {
          tenantId: tenant.id,
          keyHash: hash,
          prefix,
          label: 'bootstrap',
          scopes: ['*'],
        },
      });
      console.log('================================================================');
      console.log(`Bootstrap API key (save it now — never shown again):`);
      console.log(`  ${plaintext}`);
      console.log(`Tenant: ${tenant.id} <${tenant.email}>`);
      console.log('================================================================');
    } else {
      console.log(`Bootstrap tenant already has an active API key (id=${existing.id})`);
    }
  } finally {
    await prisma.$disconnect();
  }
})().catch((err) => {
  console.error('[seed-runtime] failed:', err);
  process.exit(1);
});
