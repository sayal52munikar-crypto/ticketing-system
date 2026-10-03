// 04_customers.js
// 100,000 customers (times SEED_SCALE), loaded with COPY.
// The number i is part of each email, so every email is unique.
// Customers signed up 2-3 years ago, before the earliest seeded order.
const { createRandom } = require('./lib/random');
const { copyInto } = require('./lib/copy');

const FIRST = ['James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
  'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Sarah', 'Carlos', 'Karen', 'Daniel', 'Lisa', 'Matthew', 'Nancy',
  'Anthony', 'Betty', 'Mark', 'Sandra', 'Wei', 'Ashley', 'Ahmed', 'Emily',
  'Hiroshi', 'Priya', 'Luis', 'Fatima', 'Kevin', 'Sofia', 'Brian', 'Aisha',
  'George', 'Olivia', 'Raj', 'Emma', 'Dmitri', 'Grace', 'Juan', 'Chloe', 'Kofi', 'Hannah'];
const LAST = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas',
  'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White',
  'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young',
  'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts'];
const DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'icloud.com', 'example.com'];

const DAY_MS = 24 * 60 * 60 * 1000;

module.exports = async function seedCustomers(client, { scale, now }) {
  const count = Math.round(100000 * scale);
  const random = createRandom(4);

  function* rows() {
    for (let i = 1; i <= count; i++) {
      const first = random.pick(FIRST);
      const last = random.pick(LAST);
      const signedUp = new Date(now - 730 * DAY_MS - random.next() * 365 * DAY_MS);
      yield [`${first}.${last}${i}@${random.pick(DOMAINS)}`.toLowerCase(), `${first} ${last}`, signedUp];
    }
  }

  return copyInto(client, 'customers', ['email', 'full_name', 'created_at'], rows());
};
