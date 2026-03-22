import * as searchService from "../services/search.service.js";

export async function search(req, res, next) {
  try {
    const payload = await searchService.search(req.query);
    res.json(payload);
  } catch (err) {
    next(err);
  }
}
