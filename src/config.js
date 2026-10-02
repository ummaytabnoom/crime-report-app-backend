require("dotenv").config();

module.exports = {
  port: Number(process.env.PORT || 3000),
  db: {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: process.env.DB_CONNECT_STRING
  }
};
