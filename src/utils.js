function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function toBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/^data:[^;]+;base64,/, "");
    return Buffer.from(cleaned, "base64");
  }
  return null;
}

function userFromRow(row) {
  if (!row) return null;
  return {
    id: row.ID,
    full_name: row.FULL_NAME,
    user_name: row.USER_NAME,
    email: row.EMAIL,
    dob: row.DOB,
    mobile: row.MOBILE,
    role: row.ROLE,
    police_id: row.POLICE_ID,
    profile_picture: row.PROFILE_PICTURE
      ? row.PROFILE_PICTURE.toString("base64")
      : null
  };
}

function crimeFromRow(row) {
  if (!row) return null;
  return {
    crime_id: row.CRIME_ID,
    id: row.ID,
    user_name: row.USER_NAME,
    full_name: row.FULL_NAME,
    zilla: row.ZILLA,
    upazilla: row.UPAZILLA,
    police_station: row.POLICE_STATION,
    area: row.AREA,
    road_name: row.ROAD_NAME,
    road_no: row.ROAD_NO,
    date_of_incident: row.DATE_OF_INCIDENT,
    category: row.CATEGORY,
    description: row.DESCRIPTION,
    status: row.STATUS,
    media_file: row.MEDIA_FILE ? row.MEDIA_FILE.toString("base64") : null,
    hide_identity: row.HIDE_IDENTITY,
    accepted: row.ACCEPTED,
    police_id: row.POLICE_ID,
    upgraded_by: row.UPGRADED_BY,
    accepted_by: row.ACCEPTED_BY,
    media_type: row.MEDIA_TYPE
  };
}

module.exports = { asyncHandler, toBuffer, userFromRow, crimeFromRow };
