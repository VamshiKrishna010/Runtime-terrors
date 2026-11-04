/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as analytics from "../analytics.js";
import type * as evidence from "../evidence.js";
import type * as incidents from "../incidents.js";
import type * as lib_evidence from "../lib/evidence.js";
import type * as lib_rescore from "../lib/rescore.js";
import type * as lib_scoring from "../lib/scoring.js";
import type * as lib_stripMetadata from "../lib/stripMetadata.js";
import type * as migrations from "../migrations.js";
import type * as reports from "../reports.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  analytics: typeof analytics;
  evidence: typeof evidence;
  incidents: typeof incidents;
  "lib/evidence": typeof lib_evidence;
  "lib/rescore": typeof lib_rescore;
  "lib/scoring": typeof lib_scoring;
  "lib/stripMetadata": typeof lib_stripMetadata;
  migrations: typeof migrations;
  reports: typeof reports;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
