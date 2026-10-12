import express from "express";
import {
  accessModel,
  createUser,
  deleteUser,
  listUsers,
  setPassword,
  signOutEverywhere,
  updateUser,
} from "../services/users.js";

/** User management — super admins only (services/accessControl.js). */
const router = express.Router();

const by = (req) => req.user?.username || req.user?.email || "";
const route = (fn) => async (req, res) => {
  try {
    res.json({ ok: true, ...(await fn(req)) });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.expose ? error.message : "Something went wrong — please try again" });
  }
};

router.get("/", route(async () => ({ users: await listUsers(), model: accessModel() })));
router.post("/", route(async (req) => ({ user: await createUser(req.body || {}, by(req)) })));
router.put("/:username", route(async (req) => ({ user: await updateUser(req.params.username, req.body || {}, by(req)) })));
router.post(
  "/:username/password",
  route(async (req) => {
    await setPassword(req.params.username, req.body?.password, by(req), { mustChange: req.body?.mustChange !== false });
    return {};
  })
);
router.post(
  "/:username/sign-out",
  route(async (req) => {
    await signOutEverywhere(req.params.username, by(req));
    return {};
  })
);
router.delete(
  "/:username",
  route(async (req) => {
    await deleteUser(req.params.username);
    return {};
  })
);

export default router;
