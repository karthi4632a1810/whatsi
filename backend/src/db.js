import mongoose from "mongoose";
import { config } from "./config.js";

export async function connectDb() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(config.mongodbUri);
  console.log("[db] connected");
}
