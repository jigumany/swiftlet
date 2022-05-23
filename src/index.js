const { ApolloServer, gql } = require("apollo-server-express");
const { createServer } = require("http");
const { execute, subscribe } = require("graphql");
const { SubscriptionServer } = require("subscriptions-transport-ws");
const { makeExecutableSchema } = require("@graphql-tools/schema");
const { PubSub } = require("graphql-subscriptions");
const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const { parse, join } = require("path");
const { createWriteStream } = require("fs");
const { GraphQLUpload, graphqlUploadExpress } = require("graphql-upload");
const VoximplantApiClient = require("@voximplant/apiclient-nodejs").default;
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");
dotenv.config();

const {
  DB_URI,
  BASE_URL,
  PORT,
  DB_NAME,
  TWILIO_SID,
  TWILIO_VERIFY_SID,
  TWILIO_AUTH_TOKEN,
  JWT_SECRET_KEY,
} = process.env;

const getToken = (user) => jwt.sign({ id: user._id }, JWT_SECRET_KEY);

const pubsub = new PubSub();

const readFile = async (file) => {
  const { createReadStream, filename } = await file;
  const stream = createReadStream();
  let { ext, name } = parse(filename);
  name = name.replace(/([^a-z0-9 ]+)/gi, "-").replace(" ", "_");
  let url = join(__dirname, `../images/${name}-${Date.now()}${ext}`);
  const imageStream = await createWriteStream(url);
  await stream.pipe(imageStream);
  url = `${BASE_URL}${PORT}${url.split("images")[1]}`;
  return url;
};

const readAudio = async (file) => {
  const { createReadStream, filename } = await file;
  const stream = createReadStream();
  let { ext, name } = parse(filename);
  name = name.replace(/([^a-z0-9 ]+)/gi, "-").replace(" ", "_");
  let url = join(__dirname, `../audios/${name}-${Date.now()}${ext}`);
  const audioStream = await createWriteStream(url);
  await stream.pipe(audioStream);
  url = `${BASE_URL}${PORT}${url.split("audios")[1]}`;
  return url;
};

const getUserFromToken = async (token, db) => {
  if (!token) {
    return null;
  }

  const tokenData = jwt.verify(token, JWT_SECRET_KEY);

  if (!tokenData?.id) {
    return null;
  }

  return await db.collection("Users").findOne({ _id: ObjectId(tokenData.id) });
};

const typeDefs = gql`
  scalar Upload

  type Query {
    getUser: User
    listUsers: [User]
    syncUsers: [User]

    listChatRooms: [ChatRoom]
    getChatRoom(id: ID!): ChatRoom
    syncChatRooms: [ChatRoom]

    listGroupChatRooms: [GroupChatRoom]

    listMessages: [Message]
    getMessage(id: ID!): Message
    syncMessages: [Message]
  }

  type Mutation {
    signUp(input: SignUpInput!): AuthUser!
    verify(input: VerifyInput!): AuthUser!
    updateUser(input: UpdateUserInput!): User
    addContactToUser(input: UserContactInput!): User
    deleteUser(id: ID!): Boolean

    createChatRoom(input: CreateChatRoomInput!): ChatRoom
    updateChatRoom(input: UpdateChatRoomInput!): ChatRoom
    deleteChatRoom(id: ID!): Boolean
    addUserToChatRoom(chatroomID: ID!, userID: ID!): ChatRoom

    createGroupChatRoom(input: CreateGroupChatRoomInput!): GroupChatRoom
    updateGroupChatRoom(input: UpdateGroupChatRoomInput!): GroupChatRoom
    deleteGroupChatRoom(id: ID): Boolean

    createMessage(input: CreateMessageInput!): Message
    createMessageImage(input: CreateImageMessageInput!): Message
    createMessageAudio(input: CreateAudioMessageInput!): Message
    updateMessage(input: UpdateMessageInput!): Message
    deleteMessage(id: ID!): Boolean
  }

  type Subscription {
    messageCreated: Message
  }

  input SignUpInput {
    name: String!
    mobile: String!
  }

  type File {
    filename: String!
    mimetype: String!
    encoding: String!
  }

  input VerifyInput {
    mobile: String!
    verification_code: String!
  }

  type AuthUser {
    user: User!
    token: String!
  }

  type User {
    id: ID!
    name: String!
    mobile: String!
    imageUri: String
    pin: String
    isVerified: Boolean
    isEnabledDisappearingMsgs: Boolean
    createdAt: String!
    updatedAt: String!
    contacts: [User]
  }

  input UpdateUserInput {
    imageUri: Upload
  }

  input UserContactInput {
    userID: ID
  }

  type ChatRoom {
    id: ID!
    newMessages: Int
    createdAt: String!
    updatedAt: String!
    LastMessage: Message
    Messages: [Message]
    ChatRoomUsers: [User]
  }

  input CreateChatRoomInput {
    id: ID
    newMessages: Int
    userID: ID
  }

  input UpdateChatRoomInput {
    id: ID!
    userID: Int
  }

  type GroupChatRoom {
    id: ID!
    groupName: String!
    groupImage: String
    adminID: ID!
    newMessages: Int
    LastMessage: Message
    Messages: [Message]
    Members: [User]
    createdAt: String!
    updatedAt: String!
  }

  input CreateGroupChatRoomInput {
    id: ID
    groupName: String!
    adminID: ID
    members: [ID]
    groupImage: Upload
  }

  input UpdateGroupChatRoomInput {
    id: ID!
    groupName: String!
    groupImage: Upload
  }

  input DeleteGroupChatRoomInput {
    id: ID!
  }

  type Message {
    id: ID!
    content: String
    userID: ID
    chatroomID: ID
    image: String
    audio: String
    name: String
    createdAt: String!
    updatedAt: String!
  }

  input CreateMessageInput {
    id: ID
    content: String
    userID: ID
    name: String
    chatroomID: ID
  }

  input CreateImageMessageInput {
    id: ID
    content: String
    userID: ID
    name: String
    chatroomID: ID
    image: Upload
  }

  input CreateAudioMessageInput {
    id: ID
    content: String
    userID: ID
    name: String
    chatroomID: ID
    audio: Upload
  }

  input UpdateMessageInput {
    id: ID!
    content: String
    userID: ID
    chatroomID: ID
    image: String
    audio: String
  }
`;

const resolvers = {
  Query: {
    getUser: async (_, __, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }
      return await db.collection("Users").findOne({ _id: user._id });
    },
    listUsers: async (_, __, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }
      return await db.collection("Users").find().toArray();
    },
    syncUsers: async (_, __, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }
      return await db.collection("Users").find().toArray();
    },

    listChatRooms: async (_, __, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }
      return await db
        .collection("ChatRooms")
        .find({ ChatRoomUsers: user._id })
        .toArray();
    },

    listGroupChatRooms: async (_, __, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }
      return await db
        .collection("GroupChatRooms")
        .find({ Members: user._id.toString() })
        .toArray();
    },

    getChatRoom: async (_, { id }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }
      return await db.collection("ChatRooms").findOne({ _id: ObjectId(id) });
    },

    syncChatRooms: async (_, __, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }
      return await db
        .collection("ChatRooms")
        .find({ ChatRoomUsers: user._id })
        .toArray();
    },

    listMessages: async (_, __, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }
      return await db
        .collection("Messages")
        .find({ userID: user._id })
        .toArray();
    },

    getMessage: async (_, { id }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }
      return await db.collection("Messages").findOne({ _id: ObjectId(id) });
    },

    syncMessages: async (_, __, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }
      return await db
        .collection("Messages")
        .find({ userID: user._id })
        .toArray();
    },
  },

  Upload: GraphQLUpload,

  // all mutations
  Mutation: {
    signUp: async (_, { input }, { db }) => {
      const newUser = {
        ...input,
        pin: Math.floor(100000 + Math.random() * 900000),
        isVerified: true,
        isEnabledDisappearingMsgs: true,
        contacts: [],
      };
      // save the user to database
      const result = await db.collection("Users").insertOne(newUser);

      // get the newly inserted user
      const user = await db
        .collection("Users")
        .findOne({ _id: result.insertedId });

      // send mobile number to twilio to get otp
      // and send sms with the opt to the mobile number
      const twilioClient = require("twilio")(TWILIO_SID, TWILIO_AUTH_TOKEN);
      await twilioClient.verify.v2
        .services(TWILIO_VERIFY_SID)
        .verifications.create({ to: input.mobile, channel: "sms" });

      // send user to voximplant
      const client = new VoximplantApiClient(
        "credentials/b7fa52d0-bd4e-4b40-8e3e-07b1bb7670a2_private.json"
      );
      client.onReady = function () {
        // Add a new user.
        client.Users.addUser({
          userName: input.name,
          userDisplayName: input.name,
          userPassword: "4Hlj%jn4",
          applicationId: "10050616",
        })
          .then((ev) => console.log(ev))
          .catch((err) => console.error(err));
      };

      return {
        user,
        token: getToken(user),
      };
    },

    verify: async (_, { input }, { db }) => {
      const user = await db
        .collection("Users")
        .findOne({ mobile: input.mobile });
      if (!user) {
        throw new Error("Invalid Credentials");
      }

      // verify the otp verification_code
      const twilioClient = require("twilio")(TWILIO_SID, TWILIO_AUTH_TOKEN);
      await twilioClient.verify.v2
        .services(TWILIO_VERIFY_SID)
        .verificationChecks.create({
          to: input.mobile,
          code: input.verification_code,
        });

      return {
        user,
        token: getToken(user),
      };
    },

    updateUser: async (_, { input }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }

      const imageUrl = await readFile(input.imageUri);

      await db.collection("Users").updateOne(
        {
          _id: ObjectId(user._id),
        },
        {
          $set: {
            imageUri: imageUrl,
          },
        }
      );

      // return the newly updated user
      return await db.collection("Users").findOne({ _id: ObjectId(user._id) });
    },

    addContactToUser: async (_, { input }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }

      const userData = await db
        .collection("Users")
        .findOne({ _id: ObjectId(user._id) });

      if (
        userData.contacts.find((dbId) => dbId.toString() === userID.toString())
      ) {
        return userData;
      }

      // add the matched user to the logged in user contacts
      await db.collection("Users").updateOne(
        {
          _id: ObjectId(user._id),
        },
        {
          $push: {
            contacts: ObjectId(input.userID),
          },
        }
      );

      // return the newly updated user
      return await db.collection("Users").findOne({ _id: ObjectId(user._id) });
    },

    deleteUser: async (_, { id }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }

      await db.collection("Users").deleteOne({ _id: ObjectId(id) });
      return true;
    },

    createChatRoom: async (_, { input }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }

      const newChatRoom = {
        newMessages: input.newMessages,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        LastMessage: {},
        Messages: [],
        ChatRoomUsers: [user._id, ObjectId(input.id)],
      };

      // insert the chatroom into database
      const result = await db.collection("ChatRooms").insertOne(newChatRoom);

      // return the newly inserted chatroom
      return await db
        .collection("ChatRooms")
        .findOne({ _id: result.insertedId });
    },

    updateChatRoom: async (_, { input }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }

      await db.collection("ChatRooms").updateOne(
        {
          _id: ObjectId(input.id),
        },
        {
          $set: {
            newMessages: input.newMessages,
          },
        }
      );

      // return the newly updated chatroom
      return await db
        .collection("ChatRooms")
        .findOne({ _id: ObjectId(input.id) });
    },

    deleteChatRoom: async (_, { id }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }

      // TODO only users in the chatroom should be able to delete
      await db.collection("ChatRooms").deleteOne({ _id: ObjectId(id) });

      return true;
    },

    addUserToChatRoom: async (_, { chatroomID, userID }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }

      const chatRoom = await db
        .collection("ChatRooms")
        .findOne({ _id: ObjectId(chatroomID) });

      if (!chatRoom) {
        return null;
      }

      if (
        chatRoom.ChatRoomUsers.find(
          (dbId) => dbId.toString() === userID.toString()
        )
      ) {
        return chatRoom;
      }

      await db.collection("ChatRooms").updateOne(
        {
          _id: ObjectId(chatroomID),
        },
        {
          $push: {
            ChatRoomUsers: ObjectId(userID),
          },
        }
      );

      chatRoom.ChatRoomUsers.push(ObjectId(userID));
      return chatRoom;
    },

    createGroupChatRoom: async (_, { input }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }

      const imageUrl = await readFile(input.groupImage);

      const newGroupChatRoom = {
        groupName: input.groupName,
        adminID: ObjectId(input.adminID),
        groupImage: imageUrl,
        LastMessage: {},
        Messages: [],
        Members: input.members,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // insert the groupchatroom into database
      const result = await db
        .collection("GroupChatRooms")
        .insertOne(newGroupChatRoom);

      // return the newly inserted groupchatroom
      return await db
        .collection("GroupChatRooms")
        .findOne({ _id: result.insertedId });
    },

    updateGroupChatRoom: async (_, { input }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }

      const imageUrl = await readFile(input.groupImage);

      await db.collection("GroupChatRooms").updateOne(
        {
          _id: ObjectId(input.id),
        },
        {
          $set: {
            groupName: input.groupName,
            groupImage: imageUrl,
          },
        }
      );

      // return the newly updated chatroom
      return await db
        .collection("GroupChatRooms")
        .findOne({ _id: ObjectId(input.id) });
    },

    deleteGroupChatRoom: async (_, { id }, { db, user }) => {
      console.log(id);
      if (!user) {
        throw new Error("Authentication Error");
      }
      await db.collection("GroupChatRooms").deleteOne({ _id: ObjectId(id) });
      return true;
    },

    createMessage: async (_, { input }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }

      const newMessage = {
        content: input.content,
        userID: ObjectId(input.userID),
        name: input.name,
        chatroomID: ObjectId(input.chatroomID),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // insert the messsage into database
      const result = await db.collection("Messages").insertOne(newMessage);

      // check for the chatroom or Groupchat room
      const isChatRoom = await db
        .collection("ChatRooms")
        .findOne({ _id: ObjectId(input.chatroomID) });

      if (isChatRoom) {
        // push the message id into the chatroom
        await db.collection("ChatRooms").updateOne(
          {
            _id: ObjectId(input.chatroomID),
          },
          {
            $push: {
              Messages: result.insertedId,
            },
            $set: {
              LastMessage: result.insertedId,
            },
          }
        );
      } else {
        // push the message id into the chatroom
        await db.collection("GroupChatRooms").updateOne(
          {
            _id: ObjectId(input.chatroomID),
          },
          {
            $push: {
              Messages: result.insertedId,
            },
            $set: {
              LastMessage: result.insertedId,
            },
          }
        );
      }

      const res = await db
        .collection("Messages")
        .findOne({ _id: result.insertedId });

      pubsub.publish("MESSAGE_CREATED", {
        messageCreated: {
          id: res._id,
          content: res.content,
          userID: res.userID,
          name: res.name,
          chatroomID: res.chatroomID,
          createdAt: res.createdAt,
          updatedAt: res.updatedAt,
        },
      });

      // return the newly inserted message
      return res;
    },

    createMessageImage: async (_, { input }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }

      const imageUrl = await readFile(input.image);

      const newMessage = {
        content: input.content,
        userID: ObjectId(input.userID),
        chatroomID: ObjectId(input.chatroomID),
        image: imageUrl,
        name: input.name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // insert the messsage into database
      const result = await db.collection("Messages").insertOne(newMessage);

      // check for the chatroom or Groupchat room
      const isChatRoom = await db
        .collection("ChatRooms")
        .findOne({ _id: ObjectId(input.chatroomID) });

      if (isChatRoom) {
        // push the message id into the chatroom
        await db.collection("ChatRooms").updateOne(
          {
            _id: ObjectId(input.chatroomID),
          },
          {
            $push: {
              Messages: result.insertedId,
            },
            $set: {
              LastMessage: result.insertedId,
            },
          }
        );
      } else {
        // push the message id into the chatroom
        await db.collection("GroupChatRooms").updateOne(
          {
            _id: ObjectId(input.chatroomID),
          },
          {
            $push: {
              Messages: result.insertedId,
            },
            $set: {
              LastMessage: result.insertedId,
            },
          }
        );
      }

      const res = await db
        .collection("Messages")
        .findOne({ _id: result.insertedId });

      pubsub.publish("MESSAGE_CREATED", {
        messageCreated: {
          id: res._id,
          content: res.content,
          userID: res.userID,
          name: res.name,
          chatroomID: res.chatroomID,
          image: res.image,
          createdAt: res.createdAt,
          updatedAt: res.updatedAt,
        },
      });

      // return the newly inserted message
      return res;
    },

    createMessageAudio: async (_, { input }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }

      const audioUrl = await readAudio(input.audio);

      const newMessage = {
        content: input.content,
        userID: ObjectId(input.userID),
        chatroomID: ObjectId(input.chatroomID),
        audio: audioUrl,
        name: input.name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // insert the messsage into database
      const result = await db.collection("Messages").insertOne(newMessage);

      // check for the chatroom or Groupchat room
      const isChatRoom = await db
        .collection("ChatRooms")
        .findOne({ _id: ObjectId(input.chatroomID) });

      if (isChatRoom) {
        // push the message id into the chatroom
        await db.collection("ChatRooms").updateOne(
          {
            _id: ObjectId(input.chatroomID),
          },
          {
            $push: {
              Messages: result.insertedId,
            },
            $set: {
              LastMessage: result.insertedId,
            },
          }
        );
      } else {
        // push the message id into the chatroom
        await db.collection("GroupChatRooms").updateOne(
          {
            _id: ObjectId(input.chatroomID),
          },
          {
            $push: {
              Messages: result.insertedId,
            },
            $set: {
              LastMessage: result.insertedId,
            },
          }
        );
      }

      const res = await db
        .collection("Messages")
        .findOne({ _id: result.insertedId });

      pubsub.publish("MESSAGE_CREATED", {
        messageCreated: {
          id: res._id,
          content: res.content,
          userID: res.userID,
          chatroomID: res.chatroomID,
          audio: res.audio,
          name: res.name,
          createdAt: res.createdAt,
          updatedAt: res.updatedAt,
        },
      });

      // return the newly inserted message
      return res;
    },

    updateMessage: async (_, { input }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }

      await db.collection("Messages").updateOne(
        {
          _id: ObjectId(input.id),
        },
        {
          $set: {
            content: input.content,
            image: input.image,
            audio: input.audio,
          },
        }
      );

      // return the newly updated message
      return await db
        .collection("Messages")
        .findOne({ _id: ObjectId(input.id) });
    },

    deleteMessage: async (_, { id }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error");
      }

      await db.collection("Messages").deleteOne({ _id: ObjectId(id) });

      // TODO delete message ID from chatroom and  update the last message.
      return true;
    },
  },

  Subscription: {
    messageCreated: {
      subscribe: () => pubsub.asyncIterator("MESSAGE_CREATED"),
    },
  },

  // custom resolver for the user
  User: {
    id: ({ _id, id }) => _id || id,
    contacts: async ({ contacts }, _, { db }) =>
      Promise.all(
        contacts.map((contact) =>
          db.collection("Users").findOne({ _id: contact })
        )
      ),
  },

  // custom resolver for the chatroom
  ChatRoom: {
    id: ({ _id, id }) => _id || id,
    LastMessage: async ({ LastMessage }, _, { db }) => {
      return await db.collection("Messages").findOne({ _id: LastMessage });
    },
    Messages: async ({ _id }, _, { db }) =>
      await db
        .collection("Messages")
        .find({ chatroomID: ObjectId(_id) })
        .toArray(),
    ChatRoomUsers: async ({ ChatRoomUsers }, _, { db }) =>
      Promise.all(
        ChatRoomUsers.map((ChatRoomUser) =>
          db.collection("Users").findOne({ _id: ChatRoomUser })
        )
      ),
  },

  GroupChatRoom: {
    id: ({ _id, id }) => _id || id,
    LastMessage: async ({ LastMessage }, _, { db }) => {
      return await db.collection("Messages").findOne({ _id: LastMessage });
    },
    Messages: async ({ _id }, _, { db }) =>
      await db
        .collection("Messages")
        .find({ chatroomID: ObjectId(_id) })
        .toArray(),
    Members: async ({ Members }, _, { db }) =>
      Promise.all(
        Members.map((Members) =>
          db.collection("Users").findOne({ _id: ObjectId(Members) })
        )
      ),
  },

  // custom resolver for the message
  Message: {
    id: ({ _id, id }) => _id || id,
  },
};

(async function () {
  const app = express();

  app.use(express.static(join(__dirname, "../images")));
  app.use(express.static(join(__dirname, "../audios")));

  const httpServer = createServer(app);

  const schema = makeExecutableSchema({
    typeDefs,
    resolvers,
  });

  const subscriptionServer = SubscriptionServer.create(
    { schema, execute, subscribe },
    { server: httpServer, path: "/graphql" }
  );

  const client = new MongoClient(DB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  await client.connect();
  client.setMaxListeners(0);
  const db = client.db(DB_NAME);

  const server = new ApolloServer({
    schema,
    context: async ({ req }) => {
      const user = await getUserFromToken(req.headers.authorization, db);
      return {
        db,
        user,
      };
    },
    plugins: [
      {
        async serverWillStart() {
          return {
            async drainServer() {
              subscriptionServer.close();
            },
          };
        },
      },
    ],
  });
  app.use(graphqlUploadExpress());
  await server.start();
  server.applyMiddleware({ app });

  httpServer.listen(PORT, () => {
    console.log(`🚀 Server is now running on http://localhost:${PORT}/graphql`);
  });
})();
