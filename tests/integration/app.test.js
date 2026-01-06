import request from 'supertest';
import { app } from '../../src/app.js';  // Keep your correct path

describe('Basic Server Health Check', () => {
  it('GET / should return "API is running..." with status 200', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.text).toBe('API is running...');
  });

  it('GET unknown route should return 404', async () => {
    const res = await request(app).get('/some-random-non-existent-route');

    expect(res.status).toBe(404);
  });
});

