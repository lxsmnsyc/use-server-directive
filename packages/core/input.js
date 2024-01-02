async function test() {
  let x = 0;

  try {
    ('use server');
    x = 5;
    throw 'foo';
  } catch (err) {
    console.log(x);
  }
}
