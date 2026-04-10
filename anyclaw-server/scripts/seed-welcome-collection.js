#!/usr/bin/env node
// @ts-check
/**
 * seed-welcome-collection.js
 *
 * Creates the `tips` PocketBase collection and inserts 3 seed rows.
 * Idempotent: skips collection creation if it exists, skips rows with
 * duplicate titles.
 *
 * Usage:
 *   PB_URL=http://127.0.0.1:8090 PB_TOKEN=<superuser-jwt> node seed-welcome-collection.js
 *
 * Requires: pocketbase 0.25.x JS SDK
 */

import PocketBase from "pocketbase";

const PB_URL = process.env.PB_URL || "http://127.0.0.1:8090";
const PB_TOKEN = process.env.PB_TOKEN || "";

const COLLECTION_NAME = "tips";

const COLLECTION_SCHEMA = {
  name: COLLECTION_NAME,
  type: "base",
  schema: [
    { name: "title", type: "text", required: true, options: { maxSize: 80 } },
    { name: "body", type: "text", required: true, options: { maxSize: 240 } },
    { name: "icon", type: "text", required: true },
  ],
};

const SEED_TIPS = [
  {
    title: "Try a feature request",
    body: "Tap Request and describe what you want in plain words.",
    icon: "Sparkles",
  },
  {
    title: "Every change is versioned",
    body: "Rolling back is one tap. Nothing is permanent.",
    icon: "History",
  },
  {
    title: "The agent learns as you go",
    body: "Your preferences carry forward. You won't be asked twice.",
    icon: "BookOpen",
  },
];

async function ensureCollection(pb) {
  try {
    await pb.collections.getOne(COLLECTION_NAME);
    console.log(`Collection '${COLLECTION_NAME}' already exists — skipping creation.`);
  } catch {
    await pb.collections.create(COLLECTION_SCHEMA);
    console.log(`Created collection '${COLLECTION_NAME}'.`);
  }
}

async function seedTips(pb) {
  const existing = await pb.collection(COLLECTION_NAME).getFullList();
  const existingTitles = new Set(existing.map((r) => r.title));

  let inserted = 0;
  for (const tip of SEED_TIPS) {
    if (existingTitles.has(tip.title)) {
      console.log(`  Tip '${tip.title}' exists — skipping.`);
      continue;
    }
    await pb.collection(COLLECTION_NAME).create(tip);
    console.log(`  Inserted tip '${tip.title}'.`);
    inserted++;
  }

  console.log(`Seeded ${inserted} new tip(s).`);
}

async function main() {
  const pb = new PocketBase(PB_URL);

  if (PB_TOKEN) {
    pb.authStore.save(PB_TOKEN, null);
  }

  await ensureCollection(pb);
  await seedTips(pb);
}

main().catch((err) => {
  console.error("Seed failed:", err.message || err);
  process.exit(1);
});
