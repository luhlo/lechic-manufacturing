import { expect, test } from "vitest";
import { Api } from "../lib/manufacturing/api";
import { localDate } from "../lib/manufacturing/domain";
import type { Context } from "../lib/manufacturing/types";
const context = {
  profile: { id: "worker" },
  permissions: ["my_work.access"],
  visibility: "OFF",
} as Context;
function client(progress: () => unknown) {
  const assignments = [
    {
      id: "today",
      employee_id: "worker",
      work_date: localDate(),
      status: "assigned",
    },
    {
      id: "past",
      employee_id: "worker",
      work_date: "2000-01-01",
      status: "assigned",
    },
    {
      id: "done",
      employee_id: "worker",
      work_date: localDate(),
      status: "completed",
    },
    {
      id: "other",
      employee_id: "other",
      work_date: localDate(),
      status: "assigned",
    },
  ];
  return {
    from(name: string) {
      const query = {
        select() {
          return query;
        },
        order() {
          return query;
        },
        eq() {
          return query;
        },
        in() {
          return query;
        },
        async range() {
          return {
            data: name === "assignments" ? assignments : [],
            error: null,
          };
        },
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "employee_directory") return { data: [], error: null };
      expect(args.p_ids).toEqual(["today"]);
      return progress();
    },
  };
}
test("assignment progress is scoped to current own work", async () => {
  const api = new Api(
    client(() => ({
      data: [{ id: "today", completed_quantity: 24 }],
      error: null,
    })) as never,
  );
  expect((await api.catalog(context)).assignments[0].completed_quantity).toBe(
    24,
  );
});
test("an unavailable optional progress read does not hide assignments", async () => {
  const api = new Api(
    client(() => {
      throw TypeError("Failed to fetch");
    }) as never,
  );
  const assignments = (await api.catalog(context)).assignments;
  expect(assignments[0].id).toBe("today");
  expect(assignments[0].completed_quantity).toBeUndefined();
});
test("progress authorization failures still propagate for access revocation", async () => {
  for (const code of ["42501", "PGRST301", "PGRST303"]) {
    const api = new Api(
      client(() => ({
        data: null,
        error: { message: "Denied", code },
      })) as never,
    );
    await expect(api.catalog(context)).rejects.toHaveProperty("code", code);
  }
});
