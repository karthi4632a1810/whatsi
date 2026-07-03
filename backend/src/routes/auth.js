import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { User } from "../models/index.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const token = jwt.sign(
    { sub: user._id.toString(), email: user.email, role: user.role },
    config.jwtSecret,
    { expiresIn: "12h" }
  );
  res.json({
    token,
    user: { id: user._id, email: user.email, name: user.name, role: user.role },
  });
});

export default router;
