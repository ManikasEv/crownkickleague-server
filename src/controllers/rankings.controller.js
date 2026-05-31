import { listGlobalRanking } from "../repositories/users.repository.js";

export async function getGlobalRanking(_req, res) {
  const rows = await listGlobalRanking();

  const entries = rows.map((row, index) => ({
    rank: index + 1,
    username: row.username,
    points: Number(row.points ?? 0),
  }));

  return res.json({ entries });
}
