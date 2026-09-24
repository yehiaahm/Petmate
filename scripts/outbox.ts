import { config } from "dotenv";
config();

import { PrismaClient } from "@prisma/client";

/**
 * Prints the development outbox.
 *
 * Useful when driving the app from a terminal rather than the browser: grab a
 * verification or reset link without opening /dev/mailbox.
 */
const db = new PrismaClient();

async function main() {
  const messages = await db.emailMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: Number(process.argv[2] ?? 5),
    select: { to: true, subject: true, status: true, text: true, createdAt: true },
  });

  if (!messages.length) {
    console.log("Outbox is empty.");
  }

  for (const message of messages) {
    console.log("─".repeat(72));
    console.log(`To:      ${message.to}`);
    console.log(`Subject: ${message.subject}`);
    console.log(`Status:  ${message.status}`);

    const links = [...message.text.matchAll(/https?:\/\/\S+/g)].map((m) => m[0]);
    for (const link of links) console.log(`Link:    ${link}`);
  }

  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
