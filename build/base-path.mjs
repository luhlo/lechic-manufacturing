export function deploymentBase(value = "/") {
  const base = value.endsWith("/") ? value : value + "/";
  if (!/^\/(?:[A-Za-z0-9._-]+\/)?$/.test(base) || base === "/../" || base === "/./")
    throw Error("BASE_PATH must be / or a single repository path such as /lechic-manufacturing/.");
  return base;
}
