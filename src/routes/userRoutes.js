const express = require("express");
const controller = require("../controllers/userController");
const { getActor, requireRole } = require("../middleware");

const router = express.Router();

router.get("/me", getActor, controller.me);

router.get(
  "/",
  getActor,
  requireRole("admin"),
  controller.listUsers
);

router.patch(
  "/:id/role",
  getActor,
  requireRole("admin"),
  controller.updateRole
);

router.delete(
  "/:id",
  getActor,
  requireRole("admin"),
  controller.deleteUser
);

module.exports = router;
