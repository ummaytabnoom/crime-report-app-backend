const express = require("express");
const controller = require("../controllers/crimeController");
const { getActor, requireRole } = require("../middleware");

const router = express.Router();

router.get("/global", controller.accepted);

router.get(
  "/pending",
  getActor,
  requireRole("admin", "police"),
  controller.pending
);

router.post(
  "/",
  getActor,
  controller.create
);

router.get(
  "/mine",
  getActor,
  controller.mine
);

router.get(
  "/search",
  controller.searchReports
);

router.get(
  "/:id",
  getActor,
  controller.getOne
);

router.patch(
  "/:id",
  getActor,
  controller.update
);

router.delete(
  "/:id",
  getActor,
  controller.remove
);

router.patch(
  "/:id/accept",
  getActor,
  requireRole("admin"),
  controller.accept
);

router.patch(
  "/:id/status",
  getActor,
  requireRole("police"),
  controller.updateStatus
);

module.exports = router;
