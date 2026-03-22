import { Router } from "express";
import * as facetController from "../controllers/facet.controller.js";

const router = Router();

router.get("/facets/categories", facetController.searchCategories);
router.get("/facets/brands", facetController.searchBrands);

export default router;
