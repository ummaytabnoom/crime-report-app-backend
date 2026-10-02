const userService = require("../services/userService");

async function register(req, res) {
  const user = await userService.register(req.body);
  res.status(201).json({ message: "Registration successful", user });
}

async function login(req, res) {
  const value = req.body.user_name || req.body.email;
  const user = await userService.login(value, req.body.password);
  res.json({ message: "Login successful", user });
}

module.exports = { register, login };
