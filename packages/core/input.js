
async function* doStuff(x, y) {
  "use server";
  yield foo(x);
  yield bar(y);
}