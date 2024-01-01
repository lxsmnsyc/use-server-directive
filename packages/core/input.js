async function* example() {
  for (let i = 0; i < 10; i++) {
    'use server';
    yield 'Count: ' + i;
  }
  return 'broken';
}
