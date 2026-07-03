import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { User } from "../src/models/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, ".env") });

const email = process.env.ADMIN_EMAIL || "admin@mapims.edu.in";
const password = process.env.ADMIN_PASSWORD || "admin123";
const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/whatsi";

await mongoose.connect(uri);
const hash = await bcrypt.hash(password, 10);
await User.findOneAndUpdate(
  { email },
  { email, passwordHash: hash, name: "MAPIMS Admin", role: "admin" },
  { upsert: true }
);
console.log(`Seeded admin user: ${email}`);
await mongoose.disconnect();
