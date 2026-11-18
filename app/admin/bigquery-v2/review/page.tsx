import {notFound} from 'next/navigation';
import ReviewClient from './ReviewClient';
export const dynamic='force-dynamic';
export const metadata={robots:{index:false,follow:false}};
export default function Page(){if(process.env.VERCEL_ENV!=='preview'||process.env.BIGQUERY_V2_PREVIEW_ENABLED!=='true')notFound();return <ReviewClient/>;}
