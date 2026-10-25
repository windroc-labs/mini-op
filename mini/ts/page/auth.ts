// Consume a Linear mail link without putting its token in an address bar or a command argument.
function page(link: string): string {
  const state = globalThis as typeof globalThis & { __miniAuth?: string };
  state.__miniAuth = "failed";
  if (!/^https:\/\/linear\.app\/auth\/email\/[A-Za-z0-9._%@/+-]+$/.test(link)) return "failed";
  if (location.origin !== "https://linear.app") return "failed";
  state.__miniAuth = "pending";
  void fetch(link, { credentials: "include", redirect: "follow" })
    .then((response) => {
      const url = new URL(response.url);
      if (
        !response.ok ||
        url.origin !== "https://linear.app" ||
        !/^\/(?!auth(?:\/|$)|login(?:\/|$))[A-Za-z0-9_/-]*$/.test(url.pathname)
      ) {
        state.__miniAuth = "failed";
        return;
      }
      state.__miniAuth = url.pathname;
    })
    .catch(() => {
      state.__miniAuth = "failed";
    });
  return "pending";
}
