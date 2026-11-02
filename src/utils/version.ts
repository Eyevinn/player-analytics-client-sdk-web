/**
 * Semantic-version comparison for the EPAS handshake.
 *
 * The eventsink advertises the EPAS version it validates against in its init
 * response (`epasVersion`). The SDK must compare that against a minimum using
 * real numeric semver ordering — a string compare would wrongly rank
 * "0.10.0" < "0.7.0". Only the major.minor.patch core is considered; any
 * pre-release/build suffix is ignored for this gate.
 */

function parse(version: string): [number, number, number] | null {
  const match = /^\s*(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Returns true when `version` is a valid semver string that is greater than or
 * equal to `minimum`. Anything that is not a parseable "x.y.z" string
 * (undefined, missing, "n/a", garbage) returns false — i.e. legacy behaviour.
 */
export function isEpasVersionAtLeast(
  version: unknown,
  minimum: string
): boolean {
  if (typeof version !== "string") {
    return false;
  }
  const actual = parse(version);
  const required = parse(minimum);
  if (!actual || !required) {
    return false;
  }
  for (let i = 0; i < 3; i++) {
    if (actual[i] > required[i]) {
      return true;
    }
    if (actual[i] < required[i]) {
      return false;
    }
  }
  return true; // exactly equal
}
