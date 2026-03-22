import * as facetService from "../services/facet.service.js";

export async function searchCategories(req, res, next) {
  try {
    const payload = await facetService.searchCategories(req.query);
    res.json(payload);
  } catch (err) {
    next(err);
  }
}

export async function searchBrands(req, res, next) {
  try {
    const payload = await facetService.searchBrands(req.query);
    res.json(payload);
  } catch (err) {
    next(err);
  }
}
