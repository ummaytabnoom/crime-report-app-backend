const userService = require("../services/userService");

async function me(req, res) {
  const user = await userService.findUserById(req.user.ID);
  res.json(user);
}

async function listUsers(req, res) {
  res.json(await userService.listUsers());
}

async function updateRole(req, res) {
  res.json(await userService.updateRole(Number(req.params.id), req.body.role));
}

async function deleteUser(req, res) {
  res.json(await userService.deleteUser(Number(req.params.id)));
}

module.exports = { me, listUsers, updateRole, deleteUser };
