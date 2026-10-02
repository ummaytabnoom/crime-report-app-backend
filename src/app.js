const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const crimeRoutes = require("./routes/crimeRoutes");

const app = express();

app.use(cors());
app.use(express.json({ limit: "15mb" }));

app.get("/", (req, res) => {
  res.json({
    message: "Crime Report API",
    status: "running"
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/crimes", crimeRoutes);

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

app.use((err, req, res, next) => {
  console.error(err);

  res.status(err.status || 500).json({
    message: err.message || "Internal server error"
  });
});

module.exports = app;
