import 'dotenv/config';
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import pg from 'pg';
import fs from 'fs'; 
import { PubSub } from 'graphql-subscriptions';  // to simulate real-time events


import mysql from 'mysql2/promise';
import DataLoader from 'dataloader';


console.log('Node Graph');

const { Pool } = pg;

// load currency rates
const rates = JSON.parse(fs.readFileSync('./rates.json', 'utf8'));

// Postgres connection
const pgPool = new Pool({ connectionString: process.env.DATABASE_URL });

const pubsub = new PubSub();   // in-memory event bus
const USER_CREATED = 'USER_CREATED';


// GraphQL schema definition (SDL)
const typeDefs = `#graphql
  type User {
    id: ID!
    name: String!
    email: String!
    createdAt: String!
  }

  type Query {
    users: [User!]!
    user(name: String!): User
    userEmail(email: String!): String
  }

  type Mutation {
    createUser(name: String!, email: String!): User!
  }

  type Subscription {
    userCreated: User!
  }
`;


// Resolvers tell GraphQL how to fetch the data
const resolvers = {
  Query: {
    users: async () => {
      const { rows } = await pgPool.query(
        'SELECT id, name, email, created_at FROM users'
      );
      // map to GraphQL field names
      return rows.map(r => ({
        id: r.id,
        name: r.name,
        email: r.email,
        createdAt: r.created_at,
      }));
    },
    user: async (_, { name }) => {
      const { rows } = await pgPool.query('SELECT * FROM users WHERE name=$1', [name]);
      const u = rows[0];
      return u
        ? { id: u.id, name: u.name, email: u.email, createdAt: u.created_at }
        : null;
    },
    userEmail: async (_, { email }) => {
        const { rows } = await pgPool.query('SELECT email FROM users WHERE email=$1',[email]);
        return rows[0]?.email || null;
    },
  },
  Mutation: {
    createUser: async (_, { name, email }) => {
      const { rows } = await pgPool.query(
        'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *',
        [name, email]
      );
      const newUser = rows[0];
      const userObj = {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        createdAt: newUser.created_at
      };
      // Publish event for subscriptions
      pubsub.publish(USER_CREATED, { userCreated: userObj });
      return userObj;
    }
  },
  Subscription: {
    userCreated: {
      subscribe: () => pubsub.asyncIterator([USER_CREATED])
    }
  }
}

const server = new ApolloServer({ typeDefs, resolvers });
const { url } = await startStandaloneServer(server, { listen: { port: 4000 } });

console.log(`🚀 GraphQL running at ${url}`);


// // --- DB connections
// const pgPool = new Pool({ connectionString: process.env.DATABASE_URL });

// async function createMariaPool() {
//   return mysql.createPool({
//     host: process.env.MARIADB_HOST,
//     port: process.env.MARIADB_PORT,
//     user: process.env.MARIADB_USER,
//     password: process.env.MARIADB_PASSWORD,
//     database: process.env.MARIADB_DATABASE,
//     waitForConnections: true,
//     connectionLimit: 10,
//   });
// }
// let mariaPool;
// createMariaPool().then(p => (mariaPool = p)).catch(console.error);

// // --- SDL
// const typeDefs = `#graphql
// scalar DateTime
// scalar Decimal

// type User {
//   id: ID!
//   name: String!
//   email: String!
//   createdAt: DateTime!
//   transactions(limit: Int = 20, offset: Int = 0): [Transaction!]!
//   totalSpentUSD: Decimal!
// }

// type Transaction {
//   id: ID!
//   userId: ID!
//   amount: Decimal!
//   currency: String!
//   createdAt: DateTime!
//   amountUSD: Decimal!
// }

// type Query {
//   user(id: ID!): User
//   users(limit: Int = 50, offset: Int = 0): [User!]!

//   transactions(userId: ID!, limit: Int = 50, offset: Int = 0): [Transaction!]!
//   rate(code: String!): Float
// }
// `;

// // --- Helpers
// const toUSD = (amount, currency) =>
//   Number(amount) * (currency === 'USD' ? 1 : (rates[currency] || 0));

// // Batch fetch transactions by many userIds (avoids N+1)
// async function batchTxByUserIds(userIds) {
//   // Build IN (?, ?, ...)
//   const placeholders = userIds.map(() => '?').join(',');
//   const [rows] = await mariaPool.query(
//     `SELECT id, user_id AS userId, amount, currency, created_at AS createdAt
//      FROM transactions WHERE user_id IN (${placeholders})
//      ORDER BY created_at DESC`,
//     userIds
//   );

//   // group by userId in the order of keys
//   const map = new Map(userIds.map(id => [id, []]));
//   for (const r of rows) {
//     map.get(r.userId)?.push(r);
//   }
//   return userIds.map(id => map.get(id));
// }

// const createLoaders = () => ({
//   txByUserId: new DataLoader(batchTxByUserIds),
// });

// // --- Resolvers
// const resolvers = {
//   Query: {
//     user: async (_, { id }) => {
//       const { rows } = await pgPool.query(
//         `SELECT id, name, email, created_at AS "createdAt" FROM users WHERE id = $1`,
//         [id]
//       );
//       return rows[0] ?? null;
//     },
//     users: async (_, { limit, offset }) => {
//       const { rows } = await pgPool.query(
//         `SELECT id, name, email, created_at AS "createdAt"
//          FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
//         [limit, offset]
//       );
//       return rows;
//     },
//     transactions: async (_, { userId, limit, offset }) => {
//       const [rows] = await mariaPool.query(
//         `SELECT id, user_id AS userId, amount, currency, created_at AS createdAt
//          FROM transactions
//          WHERE user_id = ?
//          ORDER BY created_at DESC
//          LIMIT ? OFFSET ?`,
//         [userId, Number(limit), Number(offset)]
//       );
//       return rows;
//     },
//     rate: (_, { code }) => rates[code] ?? null,
//   },

//   User: {
//     transactions: async (parent, { limit, offset }, { loaders }) => {
//       // Use the DataLoader then slice for pagination (simple demo).
//       const txAll = await loaders.txByUserId.load(parent.id);
//       return txAll.slice(offset, offset + limit);
//     },
//     totalSpentUSD: async (parent, _args, { loaders }) => {
//       const txAll = await loaders.txByUserId.load(parent.id);
//       return txAll.reduce((sum, t) => sum + toUSD(t.amount, t.currency), 0);
//     },
//   },

//   Transaction: {
//     amountUSD: (t) => toUSD(t.amount, t.currency),
//   },
// };

// // --- Server
// (async () => {
//   const server = new ApolloServer({ typeDefs, resolvers });
//   const { url } = await startStandaloneServer(server, {
//     listen: { port: Number(process.env.PORT) || 4000 },
//     context: async () => ({ loaders: createLoaders() }),
//   });
//   console.log(`🚀 GraphQL ready at ${url}`);
// })();















// const { ApolloServer, gql } = require('apollo-server');

// // 1. Define schema (SDL)
// const typeDefs = gql`
//   type Query {
//     hello: String
//     user(id: ID!): User
//   }

//   type User {
//     id: ID!
//     name: String
//     email: String
//   }
// `;

// // 2. Mock data
// const users = [
//   { id: "1", name: "Alice", email: "alice@example.com" },
//   { id: "2", name: "Bob", email: "bob@example.com" }
// ];

// // 3. Define resolvers
// const resolvers = {
//   Query: {
//     hello: () => "Hello, GraphQL with Node.js!",
//     user: (_, { id }) => users.find(user => user.id === id)
//   }
// };

// // 4. Start Apollo Server
// const server = new ApolloServer({ typeDefs, resolvers });

// server.listen().then(({ url }) => {
//   console.log(`🚀 Server ready at ${url}`);
// });

