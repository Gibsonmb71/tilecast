import type { ContentDefinitionField } from "../api/types";
import { dataSourceKeysIn } from "./DefinitionForm";

/**
 * App Recipes deliberately keep their managed Data Source out of the author-facing schema.
 * Preview compilation still needs the release-derived keys that Player projection receives.
 */
export function widgetPreviewConfiguration(
  configuration: Record<string, unknown>,
  managedDataSourceId?: string,
): Record<string, unknown> {
  if (!managedDataSourceId) return configuration;
  return {
    ...configuration,
    sourceId: managedDataSourceId,
    managedDataSourceId,
  };
}

/**
 * Resolve every Data Source a preview needs. A managed App source is explicit and first so
 * single-source presentations receive it as their primary preview, while ordinary declared
 * data_source controls (including controls inside repeating groups) continue to be followed.
 */
export function widgetPreviewDataSourceIds(
  fields: ContentDefinitionField[],
  configuration: Record<string, unknown>,
  managedDataSourceId?: string,
): string[] {
  const ids = [
    ...(managedDataSourceId ? [managedDataSourceId] : []),
    ...dataSourceKeysIn(fields, configuration),
  ];
  return [...new Set(ids)];
}
