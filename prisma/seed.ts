import { PrismaClient, Plan } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const random = randomBytes(32).toString('base64url');
  const plaintext = `sk_dev_${random}`;
  const hash = createHash('sha256').update(plaintext).digest('hex');
  const prefix = plaintext.slice(0, 14);
  return { plaintext, hash, prefix };
}

async function main() {
  const adminEmail = process.env.ADMIN_TENANT_EMAIL ?? 'admin@example.com';
  const adminName = process.env.ADMIN_TENANT_NAME ?? 'Sefaz API Admin';

  const tenant = await prisma.tenant.upsert({
    where: { email: adminEmail },
    update: {},
    create: { name: adminName, email: adminEmail, plan: Plan.ENTERPRISE },
  });

  const existing = await prisma.apiKey.findFirst({ where: { tenantId: tenant.id, revokedAt: null } });
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
    // eslint-disable-next-line no-console
    console.log(`Bootstrap API key (save it now — never shown again): ${plaintext}`);
  }

  // eslint-disable-next-line no-console
  console.log(`Admin tenant: ${tenant.id} <${tenant.email}>`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
