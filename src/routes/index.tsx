import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")(  {
  head: () => ({
    meta: [
      { title: "Tables — Z-pekenio" },
      {
        name: "description",
        content:
          "Gestion des tables Z-pekenio.",
      },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/tables" });
  },
  component: () => null,
});
