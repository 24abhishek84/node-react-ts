import { Router } from 'express';
import { z } from 'zod';
import { validate, rateLimit } from '../../middleware/index';
import type { AuthService } from './auth.service';
import type { Config } from '../../config';

const credentials = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(8).max(72),
});
const tokenBody = z.object({ refreshToken: z.string().min(1) });

interface AuthRoutesOptions {
  authService: AuthService;
  config: Config;
}

export function authRoutes({ authService, config }: AuthRoutesOptions) {
  const r = Router();
  r.use(rateLimit({ limit: config.AUTH_RATE_LIMIT }));

  r.post('/register', validate({ body: credentials }), async (req, res) => {
    const { email, password } = req.valid!.body;
    res.status(201).json(await authService.register(email, password));
  });

  r.post('/login', validate({ body: credentials }), async (req, res) => {
    const { email, password } = req.valid!.body;
    res.json(await authService.login(email, password));
  });

  r.post('/refresh', validate({ body: tokenBody }), async (req, res) => {
    res.json(await authService.refresh(req.valid!.body.refreshToken));
  });

  r.post('/logout', validate({ body: tokenBody }), async (req, res) => {
    await authService.logout(req.valid!.body.refreshToken);
    res.sendStatus(204);
  });

  return r;
}
