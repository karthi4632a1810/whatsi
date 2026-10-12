import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { User } from "../src/models/index.js";

// Creates (or resets the password of) a super admin: full access, manages
// users and Master Settings. Signs in with ADMIN_USERNAME or ADMIN_EMAIL.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, ".env") });

const email = (process.env.ADMIN_EMAIL || "admin@mapims.edu.in").toLowerCase();
const username = (process.env.ADMIN_USERNAME || "admin").toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/whatsi";

if (!password || password.length < 8) {
  console.error("Set ADMIN_PASSWORD (8+ characters) in .env first.");
  process.exit(1);
}

await mongoose.connect(uri);
const existing = await User.findOne({ $or: [{ email }, { username }] });
const hash = await bcrypt.hash(password, 10);
if (existing) {
  existing.passwordHash = hash;
  existing.role = "admin";
  existing.active = true;
  existing.mustChangePassword = false;
  existing.username ||= username;
  existing.tokenVersion = (existing.tokenVersion || 0) + 1;
  await existing.save();
} else {
  await User.create({ email, username, passwordHash: hash, name: "MAPIMS Admin", role: "admin" });
}
console.log(`Super admin ready: ${existing?.username || username} / ${email}`);
await mongoose.disconnect();
