import { populationDefinitionSchema } from "./schema.js";
import { hash } from "./identity.js";
export function fingerprintPopulationDefinition(input: unknown): string {
  return hash(populationDefinitionSchema.parse(input));
}
