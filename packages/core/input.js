async function doStuff(x, y) {
  "use server";
  await foo(x);
  await bar(y);
}