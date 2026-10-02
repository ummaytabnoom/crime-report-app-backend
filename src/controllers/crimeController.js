const crimeService = require("../services/crimeService");

async function create(req, res) {
  res.status(201).json(await crimeService.createCrime(req.user.ID, req.body));
}

async function getOne(req, res) {
  const crime = await crimeService.getCrimeById(Number(req.params.id));
  if (!crime) return res.status(404).json({ message: "Crime report not found" });
  res.json(crime);
}

async function mine(req, res) {
  res.json(await crimeService.listMyCrimes(req.user.ID));
}

async function accepted(req, res) {
  res.json(await crimeService.listAcceptedCrimes());
}

async function pending(req, res) {
  res.json(
    await crimeService.listPendingCrimes(req.user.ID)
  );
}

async function update(req, res) {
  res.json(
    await crimeService.updateCrime(
      req.user.ID,
      Number(req.params.id),
      req.body
    )
  );
}

async function remove(req, res) {
  res.json(
    await crimeService.deleteCrime(req.user.ID, Number(req.params.id))
  );
}

async function accept(req, res) {
  res.json(
    await crimeService.acceptCrime(
      req.user.ID,
      Number(req.params.id)
    )
  );
}

async function updateStatus(req, res) {
  res.json(
    await crimeService.updatePoliceStatus(
      req.user.ID,
      Number(req.params.id),
      req.body.status
    )
  );
}


async function searchReports(req, res) {
  try {
    const { q } = req.query;

    if (!q || !String(q).trim()) {
      return res.status(400).json({
        message: "Search query is required",
      });
    }

    const reports = await crimeService.searchReports(q);

    res.json(reports);
  } catch (error) {
    console.error("Search reports error:", error);

    res.status(500).json({
      message: "Failed to search reports",
    });
  }
}

module.exports = {
  create,
  getOne,
  mine,
  accepted,
  pending,
  update,
  remove,
  accept,
  searchReports,
  updateStatus
};


