const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors({
    origin: ['http://localhost:5173'],
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.x5y82lv.mongodb.net/?retryWrites=true&w=majority`;

// MongoDB connection
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        const userCollection = client.db('assetDB').collection('users');
        const paymentCollection = client.db("assetDB").collection("payments");
        const assetCollection = client.db("assetDB").collection("assets");
        const productCollection = client.db("assetDB").collection("products");

        // Custom middlewares
        const logger = async (req, res, next) => {
            console.log('called: ', req.hostname, req.originalUrl);
            console.log('log: info', req.method, req.url);
            next();
        }

        const verifyToken = async (req, res, next) => {
            const token = req?.cookies?.token;
            // console.log('Token in the middleware: ', token);

            if (!token) {
                return res.status(401).send({ message: 'unauthorized access' });
            }

            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: 'unauthorized access' });
                }

                req.decoded = decoded;
                next();
            })
        }

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isAdmin = user?.role === 'admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }

        // Auth related APIs
        try {
            app.post('/jwt', logger, async (req, res) => {
                const user = req.body;
                console.log('User: ', user);

                const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
                    expiresIn: '1h'
                });

                res
                    .cookie('token', token, {
                        httpOnly: true,
                        secure: true,
                        sameSite: 'none',
                        maxAge: 24 * 60 * 60 * 1000   // 24 hours
                    })
                    .send({ success: true });
            })
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.post('/logout', async (req, res) => {
                const user = req.body;
                console.log('Logging out', user);
                res.clearCookie('token', { maxAge: 0 }).send({ success: true });
            })
        }
        catch (error) {
            console.log(error);
        }

        // Users related APIs
        try {
            app.get('/api/v1/all-users', logger, verifyToken, async (req, res) => {
                const cursor = userCollection.find();
                const result = await cursor.sort({ timestamp: -1 }).toArray();
                res.send(result);
            })
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.get('/api/v1/users/:email', logger, verifyToken, async (req, res) => {
                const email = req.params.email;
                const query = { email: email };
                const result = await userCollection.findOne(query);
                res.send(result);
            });
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.get('/api/v1/users/user-profile/:email', logger, verifyToken, async (req, res) => {
                const email = req.params.email;
                const query = { email: email };
                const result = await userCollection.find(query).toArray();
                res.send(result);
            });
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.get('/api/v1/user-profile-info/:id', async (req, res) => {
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };
                const result = await userCollection.findOne(query);
                res.send(result);
            })
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.get('/api/v1/users/admin/:email', logger, verifyToken, async (req, res) => {
                const email = req.params.email;

                if (email !== req.decoded.email) {
                    return res.status(403).send({ message: 'forbidden access' });
                }

                const query = { email: email };
                const user = await userCollection.findOne(query);
                let admin = false;
                if (user) {
                    admin = user?.role === 'admin';
                }
                res.send({ admin });
            })
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.put('/api/v1/users/:email', async (req, res) => {
                const email = req.params.email;
                const user = req.body;
                const query = { email: email };
                const options = { upsert: true };
                const existingUser = await userCollection.findOne(query);

                if (existingUser) {
                    return res.send({ message: 'User already exists' });
                }

                const result = await userCollection.updateOne(
                    query,
                    {
                        $set: { ...user, timestamp: Date.now() }
                    },
                    options
                );
                res.send(result);
            });
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.patch('/api/v1/update-user-profile/:id', logger, verifyToken, async (req, res) => {
                console.log(req.query.email);
                // console.log('Token', req.cookies.token);
                console.log('User of the valid token', req.decoded);

                if (req.query.email !== req.decoded.email) {
                    return res.status(403).send({ message: 'forbidden access' });
                }

                const id = req.params.id;
                const filter = { _id: new ObjectId(id) };
                const updatedUserProfile = req.body;

                const userProfile = {
                    $set: {
                        email: updatedUserProfile.email,
                        name: updatedUserProfile.name,
                        dob: updatedUserProfile.dob,
                        photoURL: updatedUserProfile.photoURL,
                        timestamp: Date.now()
                    }
                }

                const result = await userCollection.updateOne(filter, userProfile);
                res.send(result);
            })
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.delete('/api/v1/remove-employee/:id', logger, verifyToken, verifyAdmin, async (req, res) => {
                console.log(req.query.email);
                // console.log('Token', req.cookies.token);
                console.log('User of the valid token', req.decoded);

                if (req.query.email !== req.decoded.email) {
                    return res.status(403).send({ message: 'forbidden access' });
                }

                const id = req.params.id;
                const query = { _id: new ObjectId(id) }
                const result = await userCollection.deleteOne(query);
                res.send(result);
            })
        }
        catch (error) {
            console.log(error);
        }

        // Payment related APIs
        try {
            app.post('/api/v1/make-payment-intent', async (req, res) => {
                const { price } = req.body;
                const amount = parseInt(price * 100);
                console.log(amount, 'Amount inside the intent');

                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amount,
                    currency: 'usd',
                    payment_method_types: ['card']
                });

                res.send({
                    clientSecret: paymentIntent.client_secret
                })
            });
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.post('/api/v1/payments', async (req, res) => {
                const payment = req.body;
                const paymentResult = await paymentCollection.insertOne(payment);
                console.log('Payment info', payment);
                res.send({ paymentResult });
            })
        }
        catch (error) {
            console.log(error);
        }

        // Assets related APIs
        try {
            app.get('/api/v1/all-assets', logger, verifyToken, verifyAdmin, async (req, res) => {
                const cursor = assetCollection.find();
                const result = await cursor.sort({ timestamp: -1 }).toArray();
                res.send(result);
            })
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.get('/api/v1/pending-assets', logger, verifyToken, verifyAdmin, async (req, res) => {
                const query = { status: 'pending' };
                const cursor = assetCollection.find(query);
                const result = await cursor.sort({ timestamp: -1 }).toArray();
                res.send(result);
            })
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.get('/api/v1/assets', logger, verifyToken, async (req, res) => {
                if (req.query.email !== req.decoded.email) {
                    return res.status(403).send({ message: 'forbidden access' });
                }

                const email = req.query.email;
                const query = { email: email };
                const cursor = assetCollection.find(query);
                const result = await cursor.sort({ timestamp: -1 }).toArray();
                res.send(result);
            })
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.get('/api/v1/asset/:id', async (req, res) => {
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };
                const result = await assetCollection.findOne(query);
                res.send(result);
            })
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.post('/api/v1/make-custom-request', logger, verifyToken, async (req, res) => {
                console.log(req.query.email);
                // console.log('Token', req.cookies.token);
                console.log('User of the valid token', req.decoded);

                if (req.query.email !== req.decoded.email) {
                    return res.status(403).send({ message: 'forbidden access' });
                }

                const newAssetRequest = req.body;
                newAssetRequest.timestamp = new Date();
                console.log(newAssetRequest);
                const result = await assetCollection.insertOne(newAssetRequest);
                res.send(result);
            })
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.patch('/api/v1/update-asset/:id', logger, verifyToken, async (req, res) => {
                console.log(req.query.email);
                // console.log('Token', req.cookies.token);
                console.log('User of the valid token', req.decoded);

                if (req.query.email !== req.decoded.email) {
                    return res.status(403).send({ message: 'forbidden access' });
                }

                const id = req.params.id;
                const filter = { _id: new ObjectId(id) };
                const updatedAsset = req.body;

                const asset = {
                    $set: {
                        email: updatedAsset.email,
                        assetName: updatedAsset.assetName,
                        assetPrice: updatedAsset.assetPrice,
                        assetType: updatedAsset.assetType,
                        assetImage: updatedAsset.assetImage,
                        whyNeeded: updatedAsset.whyNeeded,
                        additionalInfo: updatedAsset.additionalInfo,
                        status: 'pending'
                    }
                }

                const result = await assetCollection.updateOne(filter, asset);
                res.send(result);
            })
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.patch('/api/v1/assets/request-approve/:id', logger, verifyToken, verifyAdmin, async (req, res) => {
                const id = req.params.id;
                const filter = { _id: new ObjectId(id) };
                const updatedDoc = {
                    $set: {
                        status: 'approved',
                        approvalDate: new Date()
                    }
                }
                const result = await assetCollection.updateOne(filter, updatedDoc);
                res.send(result);
            })
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.patch('/api/v1/assets/request-reject/:id', logger, verifyToken, verifyAdmin, async (req, res) => {
                const id = req.params.id;
                const filter = { _id: new ObjectId(id) };
                const updatedDoc = {
                    $set: {
                        status: 'rejected'
                    }
                }
                const result = await assetCollection.updateOne(filter, updatedDoc);
                res.send(result);
            })
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.patch('/api/v1/assets/return-asset/:id', logger, verifyToken, async (req, res) => {
                const id = req.params.id;
                const filter = { _id: new ObjectId(id) };
                const updatedDoc = {
                    $set: {
                        status: 'returned'
                    }
                }
                const result = await assetCollection.updateOne(filter, updatedDoc);
                res.send(result);
            })
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.delete('/api/v1/delete-asset/:id', logger, verifyToken, async (req, res) => {
                console.log(req.query.email);
                // console.log('Token', req.cookies.token);
                console.log('User of the valid token', req.decoded);

                if (req.query.email !== req.decoded.email) {
                    return res.status(403).send({ message: 'forbidden access' });
                }

                const id = req.params.id;
                const query = { _id: new ObjectId(id) }
                const result = await assetCollection.deleteOne(query);
                res.send(result);
            })
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.delete('/api/v1/remove-asset/:id', logger, verifyToken, async (req, res) => {
                console.log(req.query.email);
                // console.log('Token', req.cookies.token);
                console.log('User of the valid token', req.decoded);

                if (req.query.email !== req.decoded.email) {
                    return res.status(403).send({ message: 'forbidden access' });
                }

                const id = req.params.id;
                const query = { _id: new ObjectId(id) }
                const result = await assetCollection.deleteOne(query);
                res.send(result);
            })
        }
        catch (error) {
            console.log(error);
        }

        // Product related APIs
        try {
            app.get('/api/v1/all-products', logger, verifyToken, async (req, res) => {
                const cursor = productCollection.find();
                const result = await cursor.sort({ timestamp: -1 }).toArray();
                res.send(result);
            })
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.get('/api/v1/products', logger, verifyToken, verifyAdmin, async (req, res) => {
                if (req.query.email !== req.decoded.email) {
                    return res.status(403).send({ message: 'forbidden access' });
                }

                const email = req.query.email;
                const query = { email: email };
                const cursor = productCollection.find(query);
                const result = await cursor.sort({ timestamp: -1 }).toArray();
                res.send(result);
            })
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.get('/api/v1/product/:id', async (req, res) => {
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };
                const result = await productCollection.findOne(query);
                res.send(result);
            })
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.post('/api/v1/add-product', logger, verifyToken, verifyAdmin, async (req, res) => {
                console.log(req.query.email);
                // console.log('Token', req.cookies.token);
                console.log('User of the valid token', req.decoded);

                if (req.query.email !== req.decoded.email) {
                    return res.status(403).send({ message: 'forbidden access' });
                }

                const newProduct = req.body;
                newProduct.timestamp = new Date();
                console.log(newProduct);
                const result = await productCollection.insertOne(newProduct);
                res.send(result);
            })
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.patch('/api/v1/update-product/:id', logger, verifyToken, verifyAdmin, async (req, res) => {
                console.log(req.query.email);
                // console.log('Token', req.cookies.token);
                console.log('User of the valid token', req.decoded);

                if (req.query.email !== req.decoded.email) {
                    return res.status(403).send({ message: 'forbidden access' });
                }

                const id = req.params.id;
                const filter = { _id: new ObjectId(id) };
                const updatedProduct = req.body;

                const product = {
                    $set: {
                        email: updatedProduct.email,
                        productName: updatedProduct.productName,
                        productType: updatedProduct.productType,
                        productQuantity: updatedProduct.productQuantity
                    }
                }

                const result = await productCollection.updateOne(filter, product);
                res.send(result);
            })
        }
        catch (error) {
            console.log(error);
        }

        try {
            app.delete('/api/v1/delete-product/:id', logger, verifyToken, verifyAdmin, async (req, res) => {
                console.log(req.query.email);
                // console.log('Token', req.cookies.token);
                console.log('User of the valid token', req.decoded);

                if (req.query.email !== req.decoded.email) {
                    return res.status(403).send({ message: 'forbidden access' });
                }

                const id = req.params.id;
                const query = { _id: new ObjectId(id) }
                const result = await productCollection.deleteOne(query);
                res.send(result);
            })
        }
        catch (error) {
            console.log(error);
        }

        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Asset management system server is running');
})

app.listen(port, () => {
    console.log(`Asset management system server is running on port: ${port}`);
})