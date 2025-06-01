// api/get-config.js (Vercel Serverless Function)
export default function handler(request, response) {
  const accessCode = process.env.SKYE_MOVIE_ACCESS_CODE;

  if (request.method !== 'GET') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!accessCode) {
    console.error('SKYE_MOVIE_ACCESS_CODE environment variable is not set in Vercel.');
    return response.status(500).json({ error: 'Access code configuration error on server.' });
  }

  response.status(200).json({ skyeMovieAccessCode: accessCode });
}
