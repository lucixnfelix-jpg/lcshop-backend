require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const Iyzipay = require("iyzipay");

const app = express();
app.use(cors());
app.use(express.json());
app.use(passport.initialize());

const NETLIFY_SITE_URL = process.env.NETLIFY_SITE_URL;
const JWT_SECRET = process.env.JWT_SECRET;

const iyzipay = new Iyzipay({
  apiKey: process.env.IYZICO_API_KEY,
  secretKey: process.env.IYZICO_SECRET_KEY,
  uri: process.env.IYZICO_URI
});

/* GOOGLE LOGIN */
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "/auth/google/callback"
}, (accessToken, refreshToken, profile, done) => done(null, profile)));

app.get("/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get("/auth/google/callback",
  passport.authenticate("google", { session: false }),
  (req, res) => {
    const email = req.user.emails[0].value;
    const name = req.user.displayName || email.split("@")[0];
    const token = jwt.sign({ email, name }, JWT_SECRET, { expiresIn: "7d" });
    res.redirect(`${NETLIFY_SITE_URL}/panel.html?token=${token}`);
  }
);

/* AUTH MIDDLEWARE */
function requireAuth(req, res, next){
  try{
    const token = req.headers.authorization?.split(" ")[1];
    if(!token) return res.status(401).json({ error: "unauthorized" });
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  }catch{
    return res.status(401).json({ error: "unauthorized" });
  }
}

/* IYZICO CHECKOUT INIT */
app.post("/api/iyzico/checkout-init", requireAuth, (req, res) => {
  const priceMap = { week: "99.00", month: "139.00", quarter: "269.00" };
  const price = priceMap[req.body.plan] || "139.00";

  const request = {
    locale: "tr",
    conversationId: "LC-" + Date.now(),
    price,
    paidPrice: price,
    currency: "TRY",
    basketId: "B" + Date.now(),
    paymentGroup: "PRODUCT",
    callbackUrl: `${process.env.PUBLIC_BASE_URL}/api/iyzico/callback`,
    buyer: {
      id: "U" + Date.now(),
      name: req.user.name,
      surname: "User",
      email: req.user.email,
      identityNumber: "11111111111",
      registrationAddress: "Digital",
      ip: "127.0.0.1",
      city: "Istanbul",
      country: "Turkey"
    },
    shippingAddress: {
      contactName: req.user.name,
      city: "Istanbul",
      country: "Turkey",
      address: "Digital"
    },
    billingAddress: {
      contactName: req.user.name,
      city: "Istanbul",
      country: "Turkey",
      address: "Digital"
    },
    basketItems: [{
      id: "P1",
      name: "Discord Boost",
      category1: "Digital",
      itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL,
      price
    }]
  };

  Iyzipay.CheckoutFormInitialize.create(request, iyzipay, (err, result) => {
    if(err || result.status !== "success"){
      return res.status(400).json({ error: "iyzico error" });
    }
    res.json({ checkoutFormContent: result.checkoutFormContent });
  });
});

/* IYZICO CALLBACK */
app.post("/api/iyzico/callback", express.urlencoded({ extended: true }), (req, res) => {
  const token = req.body.token;
  Iyzipay.CheckoutForm.retrieve({ token }, iyzipay, (err, result) => {
    if(result?.paymentStatus === "SUCCESS"){
      res.redirect(`${NETLIFY_SITE_URL}/success.html`);
    }else{
      res.redirect(`${NETLIFY_SITE_URL}/fail.html`);
    }
  });
});

/* HEALTH CHECK */
app.get("/", (req,res)=>res.send("LCShop backend OK"));

app.get("/health", (req,res)=>res.json({ ok:true }));

app.listen(process.env.PORT || 3000, () =>
  console.log("Backend running")
);
