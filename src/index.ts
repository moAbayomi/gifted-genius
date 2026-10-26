import buildApp from "./app.js";
import env from "./config/env.js";

const PORT = env.PORT;

const app = buildApp();

app.listen(PORT, () => {
  console.log("app listening on port:", PORT);
});
