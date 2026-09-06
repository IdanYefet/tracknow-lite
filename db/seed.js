// db/seed.js
// Populates a few sample affiliates so the dashboard isn't empty on first run.
const db = require("./database");

const affiliates = [
  { name: "Nova Media", email: "partnerships@novamedia.example" },
  { name: "ClickForward", email: "team@clickforward.example" },
  { name: "BrightPath Ads", email: "hello@brightpathads.example" },
];

const existing = db.prepare("SELECT COUNT(*) AS count FROM affiliates").get();

if (existing.count === 0) {
  const insert = db.prepare(
    "INSERT INTO affiliates (name, email) VALUES (?, ?)"
  );
  for (const a of affiliates) {
    insert.run(a.name, a.email);
  }
  console.log(`Seeded ${affiliates.length} affiliates.`);
} else {
  console.log("Affiliates already present — skipping seed.");
}
