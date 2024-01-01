async function* example() {
  if (test()) {
    ('use server');
    return asyncStuff();
  }
}
