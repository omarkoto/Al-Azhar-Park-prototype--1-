import { Module } from '@nestjs/common';
import { PublicRestaurantsController, RestaurantsController } from './restaurants.controller';
import { RestaurantsService } from './restaurants.service';

@Module({ controllers: [RestaurantsController, PublicRestaurantsController], providers: [RestaurantsService] })
export class RestaurantsModule {}
