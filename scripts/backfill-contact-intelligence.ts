import { prisma } from '../lib/prisma';
import { tenantStorage } from '../lib/tenant-context';
import { recalculateContactIntelligence } from '../lib/contact-intelligence/service';

async function main() {
  console.log('--- Starting Commercial Intelligence Backfill ---');
  const startTime = Date.now();

  const tenants = await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
    return await prisma.tenant.findMany({
      select: { id: true, name: true },
    });
  });

  console.log(`Found ${tenants.length} tenants to backfill.`);

  let totalProcessed = 0;
  let totalErrors = 0;

  for (const tenant of tenants) {
    console.log(`\nProcessing Tenant: ${tenant.name} (${tenant.id})`);

    const contacts = await tenantStorage.run({ tenantId: tenant.id, bypassRls: true }, async () => {
      return await prisma.contact.findMany({
        where: { tenantId: tenant.id },
        select: { id: true, email: true },
      });
    });

    console.log(`Found ${contacts.length} contacts for tenant ${tenant.id}.`);

    for (const contact of contacts) {
      try {
        await tenantStorage.run({ tenantId: tenant.id, bypassRls: true }, async () => {
          await recalculateContactIntelligence(contact.id, tenant.id);
        });
        totalProcessed++;
        if (totalProcessed % 25 === 0) {
          console.log(`Processed ${totalProcessed} contacts...`);
        }
      } catch (err) {
        totalErrors++;
        console.error(`Error calculating intelligence for contact ${contact.id} (${contact.email}):`, err);
      }
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('\n--- Commercial Intelligence Backfill Completed ---');
  console.log(`Total Contacts Processed: ${totalProcessed}`);
  console.log(`Total Errors: ${totalErrors}`);
  console.log(`Duration: ${durationSec}s`);
}

main()
  .catch((err) => {
    console.error('Fatal backfill error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
