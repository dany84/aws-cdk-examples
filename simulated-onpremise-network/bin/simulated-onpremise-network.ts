#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SimulatedOnpremiseNetworkStack } from '../lib/simulated-onpremise-network-stack';

const app = new cdk.App();
new SimulatedOnpremiseNetworkStack(app, 'SimulatedOnpremiseNetworkStack');
