// Runs once, only when MongoDB starts on an empty volume: creates the limited
// user the backend logs in with (MONGO_APP_USER / MONGO_APP_PASSWORD in .env).
// Existing installs create it by hand — see README → MongoDB login.
const user = process.env.MONGO_APP_USER;
const pwd = process.env.MONGO_APP_PASSWORD;
if (user && pwd) {
  db.getSiblingDB("whatsi").createUser({
    user,
    pwd,
    roles: [
      { role: "readWrite", db: "whatsi" },
      { role: "readWrite", db: "whatsi_integration_test" },
    ],
  });
}
